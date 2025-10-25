import { agentTools } from '../agent/agent.tools';

type OpenRouterFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function agentToolToOpenRouterTool(
  agentTool: (typeof agentTools)[number],
): OpenRouterFunctionTool {
  return {
    type: 'function',
    function: {
      name: agentTool.name,
      description: agentTool.description,
      parameters: agentTool.input_schema,
    },
  };
}

export const openrouterTools: OpenRouterFunctionTool[] = agentTools.map(
  agentToolToOpenRouterTool,
);
