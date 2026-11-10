// JSONL frames end at LF. U+2028 and U+2029 can occur inside JSON strings.
export function jsonlFrames(emit) {
  let tail = '';
  return {
    push(chunk) {
      let start = 0, end;
      while ((end = chunk.indexOf('\n', start)) !== -1) {
        emit(tail + chunk.slice(start, end), '\n');
        tail = '';
        start = end + 1;
      }
      tail += chunk.slice(start);
    },
    finish() {
      if (tail) emit(tail, '');
      tail = '';
    },
  };
}
