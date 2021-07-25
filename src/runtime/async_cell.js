import { conclude, whenFinished } from 'conclure';
import { createAtom } from 'quarx';

export function asyncCell(it, options = {}) {
  const {
    onStale = () => { throw 'STALE' },
    name = 'asyncCell'
  } = options;

  let r = null;
  const cancel = conclude(it, (error, result) => r = { error, result });

  if (r) {
    // concluded sync
    const { error, result } = r;
    if (error) throw error;
    return result;
  }

  // The flow is still running -> create an observable atom and report it observed,
  // then this function will be called again when the task completes

  const atom = createAtom(() => cancel, { name });
  whenFinished(it, ({ cancelled }) => !cancelled && atom.reportChanged());

  atom.reportObserved();
  return onStale();
}
