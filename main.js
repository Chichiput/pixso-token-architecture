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

async function readLocalArchitecture() {
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

async function readLibraryCollections() {
  const api = pixso.teamLibrary;
  if (typeof api?.getAvailableLibraryVariableCollectionsAsync !== "function" ||
      typeof api.getVariablesInLibraryCollectionAsync !== "function") {
    throw new Error("API подключённых библиотек Variables недоступен.");
  }
  const collections = await api.getAvailableLibraryVariableCollectionsAsync();
  return Promise.all(collections.map(async collection => {
    const item = {
      id: "library:" + collection.key,
      key: collection.key,
      name: collection.name,
      libraryName: collection.libraryName,
      source: "library",
      modes: [],
      tokens: []
    };
    try {
      const variables = await api.getVariablesInLibraryCollectionAsync(collection.key);
      item.tokens = variables.map(variable => ({
        id: "library:" + variable.key,
        key: variable.key,
        name: variable.name,
        path: variable.name.split("/"),
        type: variable.resolvedType,
        valuesByMode: {}
      }));
    } catch (error) {
      item.readError = String(error?.message ?? error);
    }
    return item;
  }));
}

let latestRequestId;
pixso.ui.onmessage = async incoming => {
  const message = incoming?.pluginMessage ?? incoming;
  if (message?.type !== "load-architecture") return;
  const { requestId } = message;
  pixso.ui.postMessage({ type: "architecture-loading", requestId });
  if (latestRequestId === requestId) return;
  latestRequestId = requestId;

  const [local, library] = await Promise.allSettled([readLocalArchitecture(), readLibraryCollections()]);
  const warnings = [];
  if (local.status === "rejected") warnings.push("Локальные переменные: " + String(local.reason?.message ?? local.reason));
  if (library.status === "rejected") warnings.push("Подключённые библиотеки: " + String(library.reason?.message ?? library.reason));
  if (local.status === "rejected" && library.status === "rejected") {
    pixso.ui.postMessage({ type: "architecture-error", requestId, message: warnings.join(" · ") });
    return;
  }
  const collections = local.value?.collections.map(collection => ({ ...collection, source: "local" })) ?? [];
  for (const collection of library.value ?? []) {
    if (collection.readError) warnings.push(collection.name + ": " + collection.readError);
    collections.push(collection);
  }
  pixso.ui.postMessage({ type: "architecture", requestId, architecture: { schemaVersion: 2, collections, warnings } });
};

pixso.showUI(__html__, {
  title: "Архитектура токенов",
  width: 760,
  height: 580,
  enableResize: true,
  minWidth: 380,
  minHeight: 360
});
