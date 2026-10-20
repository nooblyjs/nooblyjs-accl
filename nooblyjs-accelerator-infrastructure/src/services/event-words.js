// What each Noobly Cloud event says in Activity (the sentence without the actor: "Stevie" + "launched VM web-02").
// Every event this accelerator emits goes through withWords(), which adds `system: 'infrastructure'` and the
// sentence, unless the emitter already gave one. Event types start with `infrastructure.` (architecture.md §7);
// entries arrive with the operations that emit them (roadmap phase 1 onwards).

const WORDS = {};

/** The launcher's `events`, with every emit from this accelerator named and worded. */
export function withWords(events, words = WORDS) {
  return {
    ...events,
    emit(type, payload = {}, options) {
      const word = words[type];
      const said = payload.summary || !word ? {} : { summary: word(payload) };
      return events.emit(type, { system: 'infrastructure', ...payload, ...said }, options);
    },
  };
}
