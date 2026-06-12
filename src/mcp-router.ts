import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export type ToolHandlerContext = {
  root: string;
  settings: any;
  serverStartTime: number;
  toolCallCount: number;
  lastToolCallTime: number;
  graphCache: any;
};

export type ToolHandler = (
  args: Record<string, unknown> | undefined,
  context: ToolHandlerContext,
) => Promise<any>;

export class McpDelegationRouter {
  private handlers = new Map<string, ToolHandler>();

  /**
   * Registers a tool handler
   */
  register(name: string, handler: ToolHandler) {
    this.handlers.set(name, handler);
  }

  /**
   * Attaches the router to the MCP server
   */
  attach(server: Server, contextProvider: () => ToolHandlerContext) {
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      const args = request.params.arguments as Record<string, unknown> | undefined;
      const handler = this.handlers.get(name);

      if (!handler) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      const context = contextProvider();
      context.toolCallCount++;
      context.lastToolCallTime = Date.now();

      return await handler(args, context);
    });
  }
}

export const router = new McpDelegationRouter();
