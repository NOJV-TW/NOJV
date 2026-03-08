"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

interface MetricTrendChartProps {
  categories: readonly string[];
  integrity: readonly number[];
  submission: readonly number[];
  workspace: readonly number[];
}

export function MetricTrendChart({
  categories,
  integrity,
  submission,
  workspace
}: MetricTrendChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const chart = echarts.init(ref.current);

    chart.setOption({
      animationDuration: 700,
      backgroundColor: "transparent",
      color: ["#c4682d", "#4d6f8f", "#b89567"],
      grid: {
        bottom: 28,
        left: 8,
        right: 8,
        top: 16
      },
      legend: {
        bottom: 0,
        icon: "roundRect",
        itemHeight: 10,
        textStyle: {
          color: "#6d6157",
          fontFamily: "Manrope"
        }
      },
      tooltip: {
        backgroundColor: "rgba(31, 25, 22, 0.92)",
        borderWidth: 0,
        textStyle: {
          color: "#f7f1e8"
        },
        trigger: "axis"
      },
      xAxis: {
        axisLabel: {
          color: "#6d6157"
        },
        axisLine: {
          lineStyle: {
            color: "rgba(79, 52, 35, 0.18)"
          }
        },
        boundaryGap: false,
        data: categories,
        type: "category"
      },
      yAxis: {
        axisLabel: {
          color: "#6d6157"
        },
        splitLine: {
          lineStyle: {
            color: "rgba(79, 52, 35, 0.12)"
          }
        },
        type: "value"
      },
      series: [
        {
          areaStyle: {
            color: "rgba(196, 104, 45, 0.08)"
          },
          data: submission,
          name: "Submission",
          smooth: true,
          symbol: "none",
          type: "line"
        },
        {
          areaStyle: {
            color: "rgba(77, 111, 143, 0.08)"
          },
          data: workspace,
          name: "Workspace",
          smooth: true,
          symbol: "none",
          type: "line"
        },
        {
          areaStyle: {
            color: "rgba(184, 149, 103, 0.08)"
          },
          data: integrity,
          name: "Integrity",
          smooth: true,
          symbol: "none",
          type: "line"
        }
      ]
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(ref.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [categories, integrity, submission, workspace]);

  return <div className="h-72 w-full" ref={ref} />;
}
