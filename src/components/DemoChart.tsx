"use client";

import ReactECharts from "echarts-for-react";

const option = {
  title: {
    text: "Monthly Sales",
  },
  tooltip: {},
  xAxis: {
    data: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  },
  yAxis: {},
  series: [
    {
      name: "Sales",
      type: "bar",
      data: [5, 20, 36, 10, 10, 20],
    },
  ],
};

export default function DemoChart() {
  return <ReactECharts option={option} style={{ height: 300 }} />;
}
