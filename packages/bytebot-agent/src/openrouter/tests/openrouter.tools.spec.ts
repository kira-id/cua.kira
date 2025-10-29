import { agentTools } from '../../agent/agent.tools';
import { openrouterTools } from '../openrouter.tools';

describe('openrouterTools', () => {
  it('matches the shared agent tool definitions', () => {
    expect(openrouterTools).toHaveLength(agentTools.length);

    openrouterTools.forEach((tool, index) => {
      const agentTool = agentTools[index];
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBe(agentTool.name);
      expect(tool.function.description).toBe(agentTool.description);
      expect(tool.function.parameters).toEqual(agentTool.input_schema);
    });
  });
});
