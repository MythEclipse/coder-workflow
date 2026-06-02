// @ts-nocheck
import blessed from "blessed";
import fs from "fs";
import path from "path";

export function startDashboard() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "Coder Workflow Swarm Dashboard",
  });

  const layout = blessed.layout({
    parent: screen,
    top: "center",
    left: "center",
    width: "100%",
    height: "100%",
  });

  const header = blessed.box({
    parent: layout,
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    content: " {bold}Coder Workflow - Swarm Intelligence Dashboard{/bold} (Press Q to exit)",
    tags: true,
    style: {
      fg: "white",
      bg: "blue",
    },
  });

  const logBox = blessed.log({
    parent: layout,
    top: 3,
    left: 0,
    width: "100%",
    height: "70%",
    border: {
      type: "line",
    },
    label: " Agent Activity Log ",
    tags: true,
    scrollback: 100,
    scrollbar: {
      ch: " ",
      track: {
        bg: "yellow",
      },
      style: {
        inverse: true,
      },
    },
  });

  const statusBox = blessed.box({
    parent: layout,
    top: "75%",
    left: 0,
    width: "100%",
    height: "25%",
    border: {
      type: "line",
    },
    label: " System Status ",
    content: "{green-fg}Swarm Orchestrator Online{/green-fg}\\nWaiting for agent dispatches...",
    tags: true,
  });

  screen.key(["escape", "q", "C-c"], (ch, key) => {
    return process.exit(0);
  });

  // Mocking log tailing for demonstration
  // In a real scenario, this tails .claude/session-*.log
  const logMessages = [
    "{blue-fg}[Orchestrator]{/blue-fg} Spawning workflow-planner...",
    "{yellow-fg}[workflow-planner]{/yellow-fg} Decomposing task into 3 subtasks.",
    "{magenta-fg}[ui-engineer]{/magenta-fg} Initializing React components...",
    "{cyan-fg}[db-architect]{/cyan-fg} Analyzing schema bottlenecks...",
    "{red-fg}[rollback-engineer]{/red-fg} Starting git bisect...",
    "{green-fg}[diagram-engineer]{/green-fg} Syncing Mermaid architecture map...",
  ];

  let i = 0;
  setInterval(() => {
    if (i < logMessages.length) {
      logBox.log(logMessages[i]);
      i++;
    } else {
      logBox.log("{gray-fg}...listening for new agent events...{/gray-fg}");
    }
    screen.render();
  }, 2000);

  screen.render();
}
