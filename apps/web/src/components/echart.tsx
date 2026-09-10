"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
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
  height?: number | string;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const optionRef = useRef(option);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let resizeFrame: number | null = null;

    const initialize = () => {
      chartRef.current?.dispose();
      const styles = getComputedStyle(document.documentElement);
      const value = (name: string) => styles.getPropertyValue(name).trim();
      const chart = echarts.init(container, {
        color: [
          value("--accent-500"),
          "#3b82f6",
          "#f59e0b",
          "#8b5cf6",
          "#ef4444",
        ],
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
      chartRef.current = chart;
      chart.setOption(optionRef.current, true);
    };

    initialize();
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        chartRef.current?.resize();
        resizeFrame = null;
      });
    });
    resizeObserver.observe(container);
    const themeObserver = new MutationObserver(initialize);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    optionRef.current = option;
    chartRef.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={containerRef}
      className="echart"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
