'use strict';

// Minimal executor for a SEGMENT of an exported n8n workflow. It runs the REAL Code-node bodies and the REAL IF expressions of the workflow JSON with the same
// variables n8n gives them ($input, $, $json, $execution), follows the REAL connections, and stops at the nodes the caller names. Nodes it cannot run (PostgreSQL,
// files, commands) must be supplied as stubs, so a test states exactly what each external call returned. It never imports, activates or executes anything in n8n.
const path = require('node:path');

const byName = (workflow, name) => {
  const node = workflow.nodes.find(candidate => candidate.name === name);
  if (!node) throw new Error(`Missing node ${name}`);
  return node;
};

function lookupFactory(outputs) {
  return name => {
    const items = outputs[name];
    if (!items) throw new Error(`No data for ${name}`);
    return { first: () => items[0], all: () => items };
  };
}

function expressionBody(expression) {
  const match = /^=\{\{([\s\S]*)\}\}$/.exec(String(expression).trim());
  if (!match) throw new Error('Unexpected expression shape');
  return match[1];
}

function runNode(workflow, name, items, context) {
  const node = byName(workflow, name);
  const lookup = lookupFactory(context.outputs);
  if (context.stubs[name]) return { output: 0, items: context.stubs[name](items) };
  if (node.type.endsWith('.code')) {
    const result = new Function('$input', '$', '$execution', 'require', node.parameters.jsCode)(
      { all: () => items, first: () => items[0] }, lookup, { id: context.executionId },
      module_ => { if (module_ === 'path') return path; throw new Error('I/O forbidden'); });
    return { output: 0, items: result };
  }
  if (node.type.endsWith('.if')) {
    const condition = node.parameters.conditions.conditions[0];
    const taken = items.filter(item => {
      const value = new Function('$json', '$', '$execution', `return (${expressionBody(condition.leftValue)});`)(item.json, lookup, { id: context.executionId });
      if (typeof value !== 'boolean') throw new Error('IF strict boolean validation failed');
      return value;
    });
    return { output: taken.length === items.length ? 0 : 1, items };
  }
  throw new Error(`Node ${name} (${node.type}) needs a stub`);
}

// start: node that receives `items`. stopAt: names that end the walk (recorded, not executed). Returns the visit order and the items that reached each stop node.
function runSegment(workflow, { start, items, outputs = {}, stubs = {}, stopAt = [], executionId = 'W1' }) {
  const context = { outputs, stubs, executionId };
  const trace = [];
  const reached = {};
  const queue = [{ name: start, items }];
  while (queue.length) {
    const { name, items: current } = queue.shift();
    if (stopAt.includes(name)) { reached[name] = current; continue; }
    trace.push(name);
    const { output, items: produced } = runNode(workflow, name, current, context);
    context.outputs[name] = produced;
    const targets = (workflow.connections[name]?.main?.[output] ?? []);
    for (const target of targets) queue.push({ name: target.node, items: produced });
  }
  return { trace, reached, outputs: context.outputs };
}

module.exports = { runSegment };
