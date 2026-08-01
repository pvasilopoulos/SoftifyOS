"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import { baseChartOptions } from "./chart-theme";
import type { ReportChartPayload } from "./engine";

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[280px] items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-400">
      Φόρτωση γραφήματος…
    </div>
  ),
});

export function SoftifyApexChart({
  chart,
  height = 300,
  className,
}: {
  chart: ReportChartPayload;
  height?: number;
  className?: string;
}) {
  const isPieLike = chart.type === "donut" || chart.type === "radialBar";

  const options = useMemo<ApexOptions>(() => {
    if (isPieLike) {
      return baseChartOptions({
        labels: chart.labels ?? chart.categories ?? [],
        fill: { type: "solid" },
        stroke: { width: 0 },
        legend: { position: "bottom" },
      });
    }
    return baseChartOptions({
      xaxis: {
        categories: chart.categories ?? [],
        labels: { style: { colors: "#64748B", fontSize: "11px" } },
      },
      fill:
        chart.type === "bar"
          ? { type: "solid", opacity: 0.9 }
          : {
              type: "gradient",
              gradient: {
                shadeIntensity: 0.35,
                opacityFrom: 0.4,
                opacityTo: 0.05,
                stops: [0, 90, 100],
              },
            },
    });
  }, [chart.categories, chart.labels, chart.type, isPieLike]);

  return (
    <div className={className}>
      <ReactApexChart
        type={chart.type}
        options={options}
        series={chart.series as never}
        height={height}
        width="100%"
      />
    </div>
  );
}
