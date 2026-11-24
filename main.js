/* global pixso, __html__ */
"use strict";

function serializeToken(variable) {
  return {
    id: variable.id,
    key: variable.key,
    name: variable.name,
    path: variable.name.split("/"),
    type: variable.resolvedType,
    description: variable.description,
    hiddenFromPublishing: variable.hiddenFromPublishing,
    scopes: Array.from(variable.scopes ?? []),
    codeSyntax: { ...variable.codeSyntax },
    valuesByMode: Object.fromEntries(
      Object.entries(variable.valuesByMode).map(([modeId, value]) => [
        modeId, value !== null && typeof value === "object" ? { ...value } : value
      ])
    )
  };
}

async function readArchitecture() {
  const api = pixso.variables;
  if (typeof api?.getLocalVariableCollectionsAsync !== "function" ||
      typeof api.getLocalVariablesAsync !== "function") {
    throw new Error("Эта версия Pixso не предоставляет API локальных переменных.");
  }

  const [collections, variables] = await Promise.all([
    api.getLocalVariableCollectionsAsync(),
    api.getLocalVariablesAsync()
  ]);

  const tokensByCollection = new Map();
  for (const variable of variables) {
    if (!tokensByCollection.has(variable.variableCollectionId)) {
      tokensByCollection.set(variable.variableCollectionId, new Map());
    }
    tokensByCollection.get(variable.variableCollectionId).set(variable.id, serializeToken(variable));
  }

  return {
    schemaVersion: 1,
    collections: collections.map(collection => {
      const tokens = tokensByCollection.get(collection.id) ?? new Map();
      const ordered = [];
      for (const id of collection.variableIds) {
        if (tokens.has(id)) {
          ordered.push(tokens.get(id));
          tokens.delete(id);
        }
      }
      return {
        id: collection.id,
        key: collection.key,
        name: collection.name,
        hiddenFromPublishing: collection.hiddenFromPublishing,
        defaultModeId: collection.defaultModeId,
        modes: Array.from(collection.modes, ({ modeId, name }) => ({ id: modeId, name })),
        tokens: ordered.concat(Array.from(tokens.values()))
      };
    })
  };
}

pixso.ui.onmessage = async message => {
  if (message?.type !== "load-architecture") return;
  const { requestId } = message;
  try {
    const architecture = await readArchitecture();
    pixso.ui.postMessage({ type: "architecture", requestId, architecture });
  } catch (error) {
    pixso.ui.postMessage({ type: "architecture-error", requestId, message: String(error?.message ?? error) });
  }
};

pixso.showUI(__html__, {
  title: "Архитектура токенов",
  width: 760,
  height: 580,
  enableResize: true,
  minWidth: 380,
  minHeight: 360
});
