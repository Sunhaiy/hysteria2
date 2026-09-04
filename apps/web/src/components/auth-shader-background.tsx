"use client";

import { useEffect, useRef } from "react";

const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_colors[4];

float grainHash(vec2 point) {
  vec3 samplePoint = fract(vec3(point.xyx) * 0.1031);
  samplePoint += dot(samplePoint, samplePoint.yzx + 33.33);
  return fract((samplePoint.x + samplePoint.y) * samplePoint.z);
}

void main() {
  vec2 screenUv = gl_FragCoord.xy / u_resolution.xy;
  vec2 point = (gl_FragCoord.xy - 0.5 * u_resolution.xy)
    / min(u_resolution.x, u_resolution.y);
  float time = u_time * 0.727;
  vec3 color = u_colors[0] * 0.15;
  float weightTotal = 0.15;

  for (int index = 0; index < 4; index++) {
    float item = float(index);
    vec2 center = vec2(
      sin(time * (0.21 + item * 0.071) + item * 2.4 + 1453.0),
      cos(time * (0.17 + item * 0.093) + item * 1.7)
    ) * 0.57;
    float weight = exp(-dot(point - center, point - center) * 6.0);
    color += u_colors[index] * weight;
    weightTotal += weight;
  }

  color /= weightTotal;
  color = (color - 0.5) * 1.158 + 0.5;
  color += (grainHash(gl_FragCoord.xy + vec2(24701.0, 45043.0)) - 0.5) * 0.091;

  float edge = length(screenUv - 0.5) * 1.41421356;
  color *= 1.0 - 0.16 * smoothstep(0.42, 1.0, edge);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const COLORS = new Float32Array([
  0.0627, 0.0627, 0.0627,
  0.9608, 0.9608, 0.9608,
  0.6902, 0.6902, 0.6902,
  0.2275, 0.2275, 0.2275,
]);

const SILVER_COLORS = new Float32Array([
  0.58, 0.58, 0.58,
  0.97, 0.97, 0.97,
  0.13, 0.77, 0.37,
  0.5, 0.5, 0.5,
]);

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function AuthShaderBackground({
  palette = "monochrome",
}: {
  palette?: "monochrome" | "silver";
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER,
    );
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );

    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, "u_resolution");
    const time = gl.getUniformLocation(program, "u_time");
    const colors = gl.getUniformLocation(program, "u_colors");
    gl.uniform3fv(colors, palette === "silver" ? SILVER_COLORS : COLORS);

    let bounds = canvas.getBoundingClientRect();
    let animationFrame = 0;
    let visible = document.visibilityState === "visible";
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const startedAt = performance.now();

    const resize = () => {
      bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const rawWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
      const rawHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
      const scale = Math.min(
        1,
        Math.sqrt(2_000_000 / Math.max(1, rawWidth * rawHeight)),
      );
      const width = Math.max(1, Math.round(rawWidth * scale));
      const height = Math.max(1, Math.round(rawHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const render = (now: number) => {
      animationFrame = 0;
      if (!visible) return;
      resize();
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, reduceMotion ? 0 : (now - startedAt) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduceMotion) animationFrame = window.requestAnimationFrame(render);
    };

    const requestRender = () => {
      if (animationFrame === 0 && visible) {
        animationFrame = window.requestAnimationFrame(render);
      }
    };
    const handleVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible) requestRender();
      else if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    };

    const resizeObserver = new ResizeObserver(requestRender);
    resizeObserver.observe(canvas);
    document.addEventListener("visibilitychange", handleVisibility);
    requestRender();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [palette]);

  return (
    <canvas
      ref={canvasRef}
      className="auth2-shader"
      aria-hidden="true"
    />
  );
}
