"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export function EChart({
  option,
  height = 300,
  ariaLabel,
}: {
  option: EChartsOption;
  height?: number;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let chart: echarts.ECharts | null = null;

    const render = () => {
      chart?.dispose();
      const styles = getComputedStyle(document.documentElement);
      const value = (name: string) => styles.getPropertyValue(name).trim();
      chart = echarts.init(container, {
        color: [value("--accent-500"), "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444"],
        backgroundColor: "transparent",
        textStyle: { color: value("--text-secondary") },
        title: { textStyle: { color: value("--text-primary") } },
        legend: { textStyle: { color: value("--text-muted") } },
        categoryAxis: {
          axisLine: { lineStyle: { color: value("--border-strong") } },
          axisTick: { lineStyle: { color: value("--border-strong") } },
          axisLabel: { color: value("--text-muted") },
          splitLine: { lineStyle: { color: value("--border-default") } },
        },
        valueAxis: {
          axisLine: { lineStyle: { color: value("--border-strong") } },
          axisTick: { lineStyle: { color: value("--border-strong") } },
          axisLabel: { color: value("--text-muted") },
          splitLine: { lineStyle: { color: value("--border-default") } },
        },
        tooltip: {
          backgroundColor: value("--bg-panel-raised"),
          borderColor: value("--border-strong"),
          textStyle: { color: value("--text-primary") },
        },
      });
      chart.setOption(option, true);
    };

    render();
    const resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(container);
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chart?.dispose();
    };
  }, [option]);

  return <div ref={containerRef} className="echart" style={{ height }} role="img" aria-label={ariaLabel} />;
}
