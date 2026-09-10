import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chart data updates reuse the existing ECharts instance", async () => {
  const source = await readFile(
    new URL("../src/components/echart.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const chartRef = useRef<echarts\.ECharts \| null>/);
  assert.match(source, /const optionRef = useRef\(option\)/);
  assert.match(source, /chartRef\.current\?\.setOption\(option, true\)/);
  assert.match(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /\}, \[option\]\);[\s\S]*?echarts\.init/);
});
