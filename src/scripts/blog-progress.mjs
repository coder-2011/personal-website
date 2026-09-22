export function enableReadingProgress(bar) {
  let frame = 0;
  function update() {
    frame = 0;
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    const progress = distance > 0 ? Math.max(0, Math.min(1, window.scrollY / distance)) : 1;
    bar.style.transform = `scaleX(${progress})`;
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  // Images, fonts, and live edits can change the reading distance without a scroll.
  const observer = new ResizeObserver(schedule);
  observer.observe(document.body);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  update();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pageshow', schedule);
    bar.hidden = true;
  };
}
