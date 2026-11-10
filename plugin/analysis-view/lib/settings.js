const defaults = { conversationSearch: true, traceContext: true, traceFiles: true, evalToolSort: "time" };
const sortOptions = ["time", "errors", "calls"];

export function defineSettings(schema) {
  return schema.object({
    conversationSearch: schema.boolean().default(defaults.conversationSearch).volatile(),
    traceContext: schema.boolean().default(defaults.traceContext).volatile(),
    traceFiles: schema.boolean().default(defaults.traceFiles).volatile(),
    evalToolSort: schema.union(sortOptions).default(defaults.evalToolSort).volatile(),
  });
}

export function viewSettings(config) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const field = config?.[key];
    const value = typeof field?.get === "function" ? field.get() : field;
    const valid = key === "evalToolSort" ? sortOptions.includes(value) : typeof value === "boolean";
    return [key, valid ? value : fallback];
  }));
}
