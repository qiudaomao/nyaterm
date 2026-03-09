import type { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

export function useTerminalSettings(
  terminalRef: React.RefObject<Terminal | null>,
  fitAddonRef: React.RefObject<FitAddon | null>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  theme: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  appSettings: any,
) {
  const webglAddonRef = useRef<WebglAddon | null>(null);

  // React to hardware acceleration settings changes
  useEffect(() => {
    if (!terminalRef.current) return;

    if (appSettings.terminal.hardware_acceleration) {
      if (!webglAddonRef.current) {
        try {
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => {
            webgl.dispose();
            webglAddonRef.current = null;
          });
          terminalRef.current.loadAddon(webgl);
          webglAddonRef.current = webgl;
        } catch {
          // Fallback to DOM renderer if WebGL initialization fails
        }
      }
    } else {
      if (webglAddonRef.current) {
        webglAddonRef.current.dispose();
        webglAddonRef.current = null;
      }
    }

    return () => {
      if (webglAddonRef.current) {
        webglAddonRef.current.dispose();
        webglAddonRef.current = null;
      }
    };
  }, [appSettings.terminal.hardware_acceleration, terminalRef]);
  // React to theme changes: update terminal colors dynamically
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = { ...theme.colors.terminal };
    }
  }, [theme, terminalRef]);

  // React to appearance settings changes: font family, size, cursor etc
  useEffect(() => {
    if (terminalRef.current) {
      const options = terminalRef.current.options;
      const appearance = appSettings.appearance;
      options.fontFamily = appearance.font_family;
      options.fontSize = appearance.font_size;
      options.cursorBlink = appearance.cursor_blink;
      options.cursorStyle = appearance.cursor_style as "block" | "underline" | "bar";

      // Auto-fit on font size change
      if (fitAddonRef.current) {
        requestAnimationFrame(() => fitAddonRef.current?.fit());
      }
    }
  }, [appSettings.appearance, terminalRef, fitAddonRef]);

  // React to terminal core settings changes: scrollback
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.scrollback = appSettings.terminal.scrollback_lines;
    }
  }, [appSettings.terminal, terminalRef]);

  // React to interaction settings changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.wordSeparator = appSettings.interaction.word_separators;
    }
  }, [appSettings.interaction, terminalRef]);
}
