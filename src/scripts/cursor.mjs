(() => {
  const cursor = document.querySelector('.site-cursor');
  const tailLayer = document.querySelector('.site-cursor__tail-layer');
  if (!cursor || !tailLayer) return;
  const dots = [...document.querySelectorAll('.site-cursor__tail-dot')];
  const links = [...document.querySelectorAll('.site-github, .site-phone, .site-discord')];
  const pointer = matchMedia('(pointer: fine) and (hover: hover)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const trail = dots.map(() => ({ x: 0, y: 0 }));
  let x = 0, y = 0, targetX = 0, targetY = 0, frame = 0, visible = false, moved = false, target;

  function schedule() {
    if (!frame && visible && pointer.matches && !document.hidden) frame = requestAnimationFrame(render);
  }
  function hide() {
    cancelAnimationFrame(frame); frame = 0; visible = false;
    document.body.classList.remove('site-cursor-active');
    cursor.style.opacity = '0';
    dots.forEach(dot => { dot.style.opacity = '0'; });
    cursor.classList.remove('site-cursor--pointer');
    links.forEach(link => link.classList.remove('site-floating-link-near'));
  }
  function configure() {
    document.body.classList.toggle('site-cursor-active', pointer.matches && visible);
    tailLayer.style.display = pointer.matches && !motion.matches ? 'block' : 'none';
    if (!pointer.matches) hide(); else schedule();
  }
  function render() {
    frame = 0;
    // Read geometry together before writing styles, at most once per animation frame.
    if (moved) {
      const near = links.map(link => {
        const rect = link.getBoundingClientRect();
        return Math.hypot(Math.max(rect.left - targetX, 0, targetX - rect.right), Math.max(rect.top - targetY, 0, targetY - rect.bottom)) < 36;
      });
      cursor.classList.toggle('site-cursor--pointer', target instanceof Element && !!target.closest("a, button, input, textarea, select, label, summary, [role='button']"));
      links.forEach((link, i) => link.classList.toggle('site-floating-link-near', near[i]));
      moved = false;
    }
    x += (targetX - x) * (motion.matches ? 1 : .28);
    y += (targetY - y) * (motion.matches ? 1 : .28);
    cursor.style.opacity = '1';
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    let moving = Math.hypot(targetX - x, targetY - y) > .05;
    if (!motion.matches) trail.forEach((point, i) => {
      const leader = i === 0 ? { x: targetX, y: targetY } : trail[i - 1];
      point.x += (leader.x - point.x) * (i === 0 ? .3 : .23);
      point.y += (leader.y - point.y) * (i === 0 ? .3 : .23);
      moving ||= Math.hypot(targetX - point.x, targetY - point.y) > .05;
      dots[i].style.opacity = String(Math.max(0, .66 - i * .065));
      dots[i].style.transform = `translate3d(${point.x - 7}px, ${point.y - 7}px, 0) rotate(${45 + i * 7}deg) scale(${1 - i * .08})`;
    });
    // Once the cursor and trail settle, idle pages do no animation work.
    if (moving) schedule();
  }
  window.addEventListener('mousemove', event => {
    if (!pointer.matches || document.hidden) return;
    targetX = event.clientX; targetY = event.clientY; target = event.target; moved = true;
    if (!visible) {
      document.body.classList.add('site-cursor-active');
      x = targetX; y = targetY;
      trail.forEach(point => { point.x = x; point.y = y; });
    }
    visible = true; schedule();
  }, { passive: true });
  window.addEventListener('mouseleave', hide, { passive: true });
  window.addEventListener('blur', hide);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', configure);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
  pointer.addEventListener('change', configure);
  motion.addEventListener('change', configure);
  configure();
})();
