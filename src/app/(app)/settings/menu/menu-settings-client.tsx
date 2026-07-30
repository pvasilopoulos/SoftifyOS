"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  RotateCcw,
  Save,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import type { MenuNodeConfig } from "@/platform/navigation";

function cloneTree(tree: MenuNodeConfig[]): MenuNodeConfig[] {
  return JSON.parse(JSON.stringify(tree)) as MenuNodeConfig[];
}

function updateAt(
  tree: MenuNodeConfig[],
  path: number[],
  fn: (node: MenuNodeConfig) => MenuNodeConfig,
): MenuNodeConfig[] {
  if (path.length === 0) return tree;
  const [head, ...rest] = path;
  return tree.map((node, i) => {
    if (i !== head) return node;
    if (rest.length === 0) return fn(node);
    return {
      ...node,
      children: updateAt(node.children ?? [], rest, fn),
    };
  });
}

function moveSibling(
  list: MenuNodeConfig[],
  index: number,
  dir: -1 | 1,
): MenuNodeConfig[] {
  const next = index + dir;
  if (next < 0 || next >= list.length) return list;
  const copy = [...list];
  const item = copy[index];
  if (!item) return list;
  copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

function MenuNodeRow({
  node,
  path,
  depth,
  onChange,
  onMove,
}: {
  node: MenuNodeConfig;
  path: number[];
  depth: number;
  onChange: (path: number[], fn: (n: MenuNodeConfig) => MenuNodeConfig) => void;
  onMove: (path: number[], dir: -1 | 1) => void;
}) {
  const hidden = node.visible === false;

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2",
          hidden && "opacity-55",
        )}
        style={{ marginLeft: depth * 16 }}
      >
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            node.type === "folder"
              ? "bg-slate-100 text-slate-600"
              : "bg-teal-50 text-teal-800",
          )}
        >
          {node.type === "folder" ? "Φάκελος" : "Σύνδεσμος"}
        </span>
        <input
          value={node.label}
          onChange={(e) =>
            onChange(path, (n) => ({ ...n, label: e.target.value }))
          }
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink-950 outline-none focus:border-slate-200 focus:bg-slate-50"
        />
        {node.href ? (
          <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
            {node.href}
          </span>
        ) : null}
        <button
          type="button"
          title={hidden ? "Εμφάνιση" : "Απόκρυψη"}
          onClick={() =>
            onChange(path, (n) => ({
              ...n,
              visible: n.visible === false ? true : false,
            }))
          }
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          title="Πάνω"
          onClick={() => onMove(path, -1)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          title="Κάτω"
          onClick={() => onMove(path, 1)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <ArrowDown size={16} />
        </button>
      </div>
      {node.type === "folder"
        ? (node.children ?? []).map((child, i) => (
            <MenuNodeRow
              key={child.id}
              node={child}
              path={[...path, i]}
              depth={depth + 1}
              onChange={onChange}
              onMove={onMove}
            />
          ))
        : null}
    </div>
  );
}

export function MenuSettingsClient() {
  const [tree, setTree] = useState<MenuNodeConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/settings/menu");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    setTree(cloneTree(data.menu));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = (
    path: number[],
    fn: (n: MenuNodeConfig) => MenuNodeConfig,
  ) => {
    setTree((prev) => updateAt(prev, path, fn));
    setMessage(null);
  };

  const onMove = (path: number[], dir: -1 | 1) => {
    setTree((prev) => {
      if (path.length === 1) {
        const index = path[0];
        if (index === undefined) return prev;
        return moveSibling(prev, index, dir);
      }
      const parentPath = path.slice(0, -1);
      const index = path[path.length - 1];
      if (index === undefined) return prev;
      return updateAt(prev, parentPath, (parent) => ({
        ...parent,
        children: moveSibling(parent.children ?? [], index, dir),
      }));
    });
    setMessage(null);
  };

  const addFolder = () => {
    const id = `folder_${Date.now().toString(36)}`;
    setTree((prev) => [
      ...prev,
      {
        id,
        type: "folder",
        label: "Νέος φάκελος",
        icon: "FolderTree",
        children: [],
      },
    ]);
    setMessage(null);
  };

  const save = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu: tree }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setTree(cloneTree(data.menu));
      setMessage("Το μενού αποθηκεύτηκε. Ανανεώστε τη σελίδα για το sidebar.");
    });
  };

  const reset = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία επαναφοράς");
        return;
      }
      setTree(cloneTree(data.menu));
      setMessage("Επαναφορά στο προεπιλεγμένο μενού.");
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
          >
            <ArrowLeft size={14} /> Ρυθμίσεις
          </Link>
          <PageHeader
            title="Μενού πλοήγησης"
            description="Μετονομασία, φακέλοι, σειρά και ορατότητα — αποθηκεύεται ανά tenant."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={addFolder} disabled={pending}>
            <FolderPlus size={16} /> Νέος φάκελος
          </Button>
          <Button variant="secondary" size="sm" onClick={reset} disabled={pending}>
            <RotateCcw size={16} /> Επαναφορά
          </Button>
          <Button size="sm" onClick={save} disabled={pending || !loaded}>
            <Save size={16} /> Αποθήκευση
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      <div className="soft-panel space-y-2 p-4">
        {!loaded ? (
          <p className="text-sm text-slate-500">Φόρτωση…</p>
        ) : (
          tree.map((node, i) => (
            <MenuNodeRow
              key={node.id}
              node={node}
              path={[i]}
              depth={0}
              onChange={onChange}
              onMove={onMove}
            />
          ))
        )}
      </div>
    </div>
  );
}
