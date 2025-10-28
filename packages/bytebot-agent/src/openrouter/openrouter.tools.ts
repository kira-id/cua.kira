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

/**
 * Individual tool exports for selective usage (keeping for backward compatibility)
 */
const toolMap = agentTools.reduce(
  (acc, tool) => {
    const openRouterTool = agentToolToOpenRouterTool(tool);
    const camelCaseName = tool.name
      .split('_')
      .map((part, index) => {
        if (index === 0) return part;
        if (part === 'computer') return '';
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join('')
      .replace(/^computer/, '');

    acc[camelCaseName + 'Tool'] = openRouterTool;
    return acc;
  },
  {} as Record<string, OpenRouterFunctionTool>,
);

// Export individual tools with proper names for consistency (keeping for backward compatibility)
export const moveMouseTool = toolMap.moveMouseTool;
export const traceMouseTool = toolMap.traceMouseTool;
export const clickMouseTool = toolMap.clickMouseTool;
export const pressMouseTool = toolMap.pressMouseTool;
export const dragMouseTool = toolMap.dragMouseTool;
export const scrollTool = toolMap.scrollTool;
export const typeKeysTool = toolMap.typeKeysTool;
export const pressKeysTool = toolMap.pressKeysTool;
export const typeTextTool = toolMap.typeTextTool;
export const pasteTextTool = toolMap.pasteTextTool;
export const waitTool = toolMap.waitTool;
export const screenshotTool = toolMap.screenshotTool;
export const cursorPositionTool = toolMap.cursorPositionTool;
export const setTaskStatusTool = toolMap.setTaskStatusTool;
export const createTaskTool = toolMap.createTaskTool;
export const applicationTool = toolMap.applicationTool;

export const openrouterTools: OpenRouterFunctionTool[] = agentTools.map(
  agentToolToOpenRouterTool,
);
