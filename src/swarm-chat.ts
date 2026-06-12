import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureParentDirSync } from "./utils/index.js";

export interface SwarmMessage {
  id: string;
  timestamp: string;
  sender: string;
  recipient: string; // 'all' or specific agent name
  content: string;
}

function getChatFilePath(root: string): string {
  return join(root, ".claude", "swarm-chat.json");
}

function ensureDir(filePath: string) {
  ensureParentDirSync(filePath);
}

export function sendSwarmMessage(
  root: string,
  sender: string,
  recipient: string,
  content: string,
): SwarmMessage {
  const filePath = getChatFilePath(root);
  ensureDir(filePath);

  // Payload safeguard: Truncate excessively large messages
  if (content.length > 50000) {
    content = content.substring(0, 50000) + "\n... [Truncated: Exceeded 50KB limit]";
  }
  // Broadcast safeguard
  if (recipient === "all" && content.length > 10000) {
    content = "[BROADCAST WARNING] Large broadcasts degrade performance. Please target specific agents if possible.\n\n" + content;
  }

  let messages: SwarmMessage[] = [];
  if (existsSync(filePath)) {
    try {
      messages = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // If corrupted, start fresh
      messages = [];
    }
  }

  const newMessage: SwarmMessage = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    sender,
    recipient,
    content,
  };

  messages.push(newMessage);
  writeFileSync(filePath, JSON.stringify(messages, null, 2), "utf-8");

  return newMessage;
}

export function readSwarmMessages(
  root: string,
  recipientFilter?: string,
  sinceTimestamp?: string,
): SwarmMessage[] {
  const filePath = getChatFilePath(root);
  if (!existsSync(filePath)) {
    return [];
  }

  let messages: SwarmMessage[] = [];
  try {
    messages = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }

  let filtered = messages;
  if (recipientFilter && recipientFilter !== "all") {
    filtered = filtered.filter(
      (m) =>
        m.recipient === "all" || m.recipient === recipientFilter || m.sender === recipientFilter,
    );
  }

  if (sinceTimestamp) {
    const sinceTime = new Date(sinceTimestamp).getTime();
    filtered = filtered.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
  }

  return filtered;
}
