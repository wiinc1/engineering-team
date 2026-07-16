'use strict';

const { END, START, StateGraph } = require('@langchain/langgraph');
const { LangGraphRuntimeError } = require('./errors');
const {
  FactoryStateAnnotation,
  appendObjectsReducer,
  uniqueSortedReducer,
  validateFactoryState,
} = require('./state');

const NODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const UPDATE_KEYS = new Set(['lifecycleNode', 'completedNodes', 'artifacts', 'decisions', 'attempt', 'updatedAt']);

function validateNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new TypeError('At least one domain node is required.');
  const names = new Set();
  for (const node of nodes) {
    if (!node || !NODE_PATTERN.test(node.name || '') || typeof node.execute !== 'function') {
      throw new TypeError('Each domain node requires a stable snake_case name and execute function.');
    }
    if (names.has(node.name)) throw new TypeError(`Duplicate LangGraph node: ${node.name}`);
    names.add(node.name);
  }
}

function wrapDomainNode(node, options) {
  return async (rawState) => {
    const state = validateFactoryState(rawState, { maxBytes: options.maxStateBytes });
    const update = await node.execute(state);
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'node_update' } });
    }
    for (const key of Object.keys(update)) if (!UPDATE_KEYS.has(key)) {
      throw new LangGraphRuntimeError('langgraph_state_invalid', { safeDetails: { reason: 'node_identity_mutation', field: key } });
    }
    const normalizedUpdate = {
      ...update,
      lifecycleNode: node.name,
      completedNodes: [node.name],
      updatedAt: new Date(options.clock.now()).toISOString(),
    };
    validateFactoryState({
      ...state,
      ...normalizedUpdate,
      completedNodes: uniqueSortedReducer(state.completedNodes, normalizedUpdate.completedNodes),
      artifacts: appendObjectsReducer(state.artifacts, normalizedUpdate.artifacts || []),
      decisions: appendObjectsReducer(state.decisions, normalizedUpdate.decisions || []),
      attempt: Math.max(state.attempt, normalizedUpdate.attempt ?? state.attempt),
    }, { maxBytes: options.maxStateBytes });
    return normalizedUpdate;
  };
}

function compileFactoryGraph(options = {}) {
  validateNodes(options.nodes);
  const graph = new StateGraph(FactoryStateAnnotation);
  for (const node of options.nodes) graph.addNode(node.name, wrapDomainNode(node, options));
  graph.addEdge(START, options.nodes[0].name);
  for (let index = 0; index < options.nodes.length - 1; index += 1) {
    graph.addEdge(options.nodes[index].name, options.nodes[index + 1].name);
  }
  graph.addEdge(options.nodes.at(-1).name, END);
  return graph.compile({
    checkpointer: options.checkpointer,
    interruptAfter: options.interruptAfter,
    interruptBefore: options.interruptBefore,
  });
}

module.exports = { compileFactoryGraph, validateNodes, wrapDomainNode };
