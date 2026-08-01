import type { ApexOptions } from "apexcharts";

/** Softify slate/teal palette — avoid purple glow defaults */
export const SOFTIFY_CHART_COLORS = [
  "#0F766E", // teal-700
  "#334155", // slate-700
  "#0EA5A4", // teal-ish
  "#64748B", // slate-500
  "#B45309", // amber-700
  "#BE123C", // rose-700
  "#1D4ED8", // blue-700
  "#15803D", // green-700
];

export function baseChartOptions(
  overrides?: ApexOptions,
): ApexOptions {
  return {
    chart: {
      fontFamily: "inherit",
      toolbar: { show: true, tools: { download: true } },
      zoom: { enabled: false },
      animations: { enabled: true, speed: 450 },
      background: "transparent",
    },
    colors: SOFTIFY_CHART_COLORS,
    dataLabels: { enabled: false },
    stroke: { curve: "smooth", width: 2.5 },
    grid: {
      borderColor: "#E2E8F0",
      strokeDashArray: 4,
      padding: { left: 8, right: 8 },
    },
    xaxis: {
      labels: { style: { colors: "#64748B", fontSize: "11px" } },
      axisBorder: { color: "#E2E8F0" },
      axisTicks: { color: "#E2E8F0" },
    },
    yaxis: {
      labels: {
        style: { colors: "#64748B", fontSize: "11px" },
        formatter: (v) =>
          Number.isFinite(v)
            ? Math.abs(v) >= 1000
              ? `${Math.round(v / 100) / 10}k`
              : String(Math.round(v * 100) / 100)
            : "",
      },
    },
    legend: {
      position: "top",
      horizontalAlign: "left",
      fontSize: "12px",
      labels: { colors: "#475569" },
      markers: { size: 8 },
    },
    tooltip: {
      theme: "light",
      style: { fontSize: "12px" },
    },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 0.35,
        opacityFrom: 0.45,
        opacityTo: 0.05,
        stops: [0, 90, 100],
      },
    },
    plotOptions: {
      bar: { borderRadius: 6, columnWidth: "55%" },
      pie: {
        donut: {
          size: "68%",
          labels: {
            show: true,
            total: {
              show: true,
              label: "Σύνολο",
              fontSize: "12px",
              color: "#64748B",
            },
          },
        },
      },
      radialBar: {
        hollow: { size: "42%" },
        dataLabels: {
          name: { fontSize: "12px", color: "#64748B" },
          value: { fontSize: "16px", fontWeight: 600, color: "#0F172A" },
        },
      },
    },
    ...overrides,
  };
}
