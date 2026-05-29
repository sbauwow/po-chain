"use client";

import { useEffect, useRef, useState } from "react";
import { downsampleMono } from "@/lib/ep-tool";

type Props = {
  buffer: AudioBuffer;
  startSec: number;
  endSec: number;
  onChange: (startSec: number, endSec: number) => void;
};

const HEIGHT = 140;

export function Waveform({ buffer, startSec, endSec, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const dragRef = useRef<"start" | "end" | null>(null);

  // observe width
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setWidth(Math.max(200, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // render
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = width * dpr;
    cvs.height = HEIGHT * dpr;
    cvs.style.width = `${width}px`;
    cvs.style.height = `${HEIGHT}px`;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, HEIGHT);

    // background
    ctx.fillStyle = "#0a0a0b";
    ctx.fillRect(0, 0, width, HEIGHT);

    // grid baseline
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT / 2);
    ctx.lineTo(width, HEIGHT / 2);
    ctx.stroke();

    // waveform peaks
    const { min, max } = downsampleMono(buffer, width);
    ctx.strokeStyle = "#a1a1aa";
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const yMin = HEIGHT / 2 - (min[x] * HEIGHT) / 2;
      const yMax = HEIGHT / 2 - (max[x] * HEIGHT) / 2;
      ctx.moveTo(x + 0.5, yMin);
      ctx.lineTo(x + 0.5, yMax);
    }
    ctx.stroke();

    // selection
    const xStart = (startSec / buffer.duration) * width;
    const xEnd = (endSec / buffer.duration) * width;
    ctx.fillStyle = "rgba(245, 158, 11, 0.18)";
    ctx.fillRect(xStart, 0, Math.max(1, xEnd - xStart), HEIGHT);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, HEIGHT);
    ctx.moveTo(xEnd, 0);
    ctx.lineTo(xEnd, HEIGHT);
    ctx.stroke();

    // handle caps
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(xStart - 4, 0, 8, 8);
    ctx.fillRect(xEnd - 4, HEIGHT - 8, 8, 8);
  }, [buffer, startSec, endSec, width]);

  function pickHandle(clientX: number): "start" | "end" | null {
    const cvs = canvasRef.current;
    if (!cvs) return null;
    const rect = cvs.getBoundingClientRect();
    const x = clientX - rect.left;
    const xStart = (startSec / buffer.duration) * width;
    const xEnd = (endSec / buffer.duration) * width;
    if (Math.abs(x - xStart) <= 8) return "start";
    if (Math.abs(x - xEnd) <= 8) return "end";
    return null;
  }

  function setFromClientX(clientX: number, handle: "start" | "end") {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, clientX - rect.left));
    const sec = (x / width) * buffer.duration;
    if (handle === "start") {
      onChange(Math.min(sec, endSec - 0.001), endSec);
    } else {
      onChange(startSec, Math.max(sec, startSec + 0.001));
    }
  }

  return (
    <div ref={wrapRef} className="w-full select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={(e) => {
          dragRef.current = pickHandle(e.clientX);
          if (dragRef.current === null) {
            // click in middle of waveform: snap nearest handle
            const cvs = canvasRef.current;
            if (cvs) {
              const rect = cvs.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const xStart = (startSec / buffer.duration) * width;
              const xEnd = (endSec / buffer.duration) * width;
              dragRef.current = Math.abs(x - xStart) < Math.abs(x - xEnd) ? "start" : "end";
              setFromClientX(e.clientX, dragRef.current);
            }
          }
        }}
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          setFromClientX(e.clientX, dragRef.current);
        }}
        onMouseUp={() => (dragRef.current = null)}
        onMouseLeave={() => (dragRef.current = null)}
        onTouchStart={(e) => {
          const t = e.touches[0];
          dragRef.current = pickHandle(t.clientX) ?? "start";
          setFromClientX(t.clientX, dragRef.current);
        }}
        onTouchMove={(e) => {
          if (!dragRef.current) return;
          const t = e.touches[0];
          setFromClientX(t.clientX, dragRef.current);
        }}
        onTouchEnd={() => (dragRef.current = null)}
        className="rounded-md border border-zinc-800 cursor-ew-resize"
      />
    </div>
  );
}
