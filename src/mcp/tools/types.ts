export interface McpTool {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, root: string) => Promise<unknown>;
}
