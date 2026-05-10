"use client";

import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import "@xterm/xterm/css/xterm.css";

type TerminalTheme = "light" | "dark";

interface TerminalSurfaceProps {
  terminalRef?: MutableRefObject<any | null>;
  onReady?: (terminal: any) => void;
  className?: string;
  theme?: TerminalTheme;
}

const lightTheme = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  cursor: "#000000",
  cursorAccent: "#ffffff",
  selectionBackground: "#d1d5da",
  black: "#1a1a1a",
  red: "#d73a49",
  green: "#22863a",
  yellow: "#b08800",
  blue: "#0366d6",
  magenta: "#6f42c1",
  cyan: "#1b7c83",
  white: "#6a737d",
  brightBlack: "#959da5",
  brightRed: "#cb2431",
  brightGreen: "#22863a",
  brightYellow: "#dbab09",
  brightBlue: "#0366d6",
  brightMagenta: "#6f42c1",
  brightCyan: "#1b7c83",
  brightWhite: "#1a1a1a",
};

const darkTheme = {
  background: "#000000",
  foreground: "#cccccc",
  cursor: "#ffffff",
  cursorAccent: "#000000",
  selectionBackground: "#444444",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

function themeFor(mode: TerminalTheme) {
  return mode === "light" ? lightTheme : darkTheme;
}

const TerminalSurface: React.FC<TerminalSurfaceProps> = ({
  terminalRef,
  onReady,
  className = "",
  theme = "light",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalTerminalRef = useRef<any | null>(null);
  const targetRef = terminalRef ?? internalTerminalRef;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const initialize = async () => {
      if (!containerRef.current || targetRef.current) return;

      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (cancelled || !containerRef.current) return;

      const terminal = new Terminal({
        fontFamily: "Consolas, monospace",
        fontSize: 14,
        lineHeight: 1.0,
        letterSpacing: 0,
        theme: themeFor(theme),
        cursorBlink: true,
        scrollback: 1000,
        convertEol: true,
      });
      const fitAddon = new FitAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      terminal.open(containerRef.current);
      targetRef.current = terminal;

      const containerElement = containerRef.current;
      const fit = () => {
        try {
          fitAddon.fit();
          terminal.scrollToBottom();
        } catch (error) {
          console.error("Error fitting terminal:", error);
        }
      };

      window.setTimeout(fit, 100);
      const resizeObserver = new ResizeObserver(fit);
      resizeObserver.observe(containerElement);
      window.addEventListener("resize", fit);

      onReady?.(terminal);

      cleanup = () => {
        resizeObserver.disconnect();
        window.removeEventListener("resize", fit);
        terminal.dispose();
        if (targetRef.current === terminal) {
          targetRef.current = null;
        }
      };
    };

    void initialize();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const terminal = targetRef.current;
    if (!terminal) return;
    terminal.options.theme = themeFor(theme);
  }, [theme, targetRef]);

  return (
    <div
      ref={containerRef}
      className={`terminal-container w-full h-full ${className}`}
      style={{
        height: "100%",
        width: "100%",
        overflow: "hidden",
        padding: "8px",
        fontSmooth: "antialiased",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      }}
    />
  );
};

export default TerminalSurface;
