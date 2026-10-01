// MODULE: Landing page, page transitions & animations
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Curtain wipe between landing and auth pages
  function swap(fn) {
    const c = $('#curtain');
    c.classList.remove('run'); void c.offsetWidth; c.classList.add('run');
    setTimeout(fn, calm ? 0 : 450);
  }
  window.openAuth = tab => swap(() => {
    $('#landing').style.display = 'none';
    $('#loginScreen').style.display = 'flex';
    switchLoginTab(tab);
    scrollTo(0, 0);
  });
  window.goHome = () => swap(() => {
    $('#loginScreen').style.display = 'none';
    $('#landing').style.display = 'block';
    scrollTo(0, 0);
    initReveal();
    refreshStats();
  });

  // Scroll reveal
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.2 });
  function initReveal() {
    $$('.rv, .steps').forEach(el => { el.classList.remove('in'); io.observe(el); });
  }

  // Animated counters (live data from the server)
  function countUp(el, to) {
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min((t - t0) / 1400, 1);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  async function refreshStats() {
    try {
      await syncAllData();
      countUp($('#statVoters'), state.voters.length);
      countUp($('#statVotes'), state.votes.length);
      countUp($('#statCands'), state.candidates.length);
    } catch (e) { /* server offline: counters stay at 0 */ }
  }

  // Nav shrink + scroll progress
  addEventListener('scroll', () => {
    $('#nav').classList.toggle('stuck', scrollY > 30);
    const h = document.documentElement.scrollHeight - innerHeight;
    $('#progress').style.width = (h > 0 ? (scrollY / h) * 100 : 0) + '%';
  }, { passive: true });

  // Hero spotlight follows the cursor
  $('.hero').addEventListener('mousemove', e => {
    e.currentTarget.style.setProperty('--mx', e.clientX + 'px');
    e.currentTarget.style.setProperty('--my', e.clientY + 'px');
  });

  // Floating particles
  const dots = $('#dots');
  for (let i = 0; i < 26; i++) {
    const d = document.createElement('i');
    d.style.cssText = `left:${Math.random() * 100}%;width:${3 + Math.random() * 6}px;height:${3 + Math.random() * 6}px;` +
      `animation-duration:${8 + Math.random() * 12}s;animation-delay:-${Math.random() * 15}s;--sx:${(Math.random() - .5) * 120}px`;
    dots.appendChild(d);
  }

  // 3D tilt on tiles
  $$('.tilt').forEach(el => {
    el.addEventListener('mousemove', e => {
      if (!el.classList.contains('in')) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      el.style.transition = 'transform .1s';
      el.style.transform = `perspective(700px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-6px)`;
    });
    el.addEventListener('mouseleave', () => { el.style.transition = ''; el.style.transform = ''; });
  });

  // Button ripple
  document.addEventListener('click', e => {
    const b = e.target.closest('.btn');
    if (!b || calm) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.appendChild(span);
    setTimeout(() => span.remove(), 650);
  });

  // Confetti burst after a vote is submitted
  window.burst = () => {
    if (calm) return;
    const c = $('#fx'), x = c.getContext('2d');
    c.width = innerWidth; c.height = innerHeight;
    const cols = ['#5b3df5', '#ffb020', '#12b886', '#ff4d6d', '#4cc9f0'];
    const ps = Array.from({ length: 150 }, () => ({
      x: innerWidth / 2, y: innerHeight * .6, vx: (Math.random() - .5) * 18, vy: -Math.random() * 17 - 4,
      s: Math.random() * 7 + 5, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[Math.random() * 5 | 0]
    }));
    let n = 0;
    (function frame() {
      x.clearRect(0, 0, c.width, c.height);
      ps.forEach(p => {
        p.vy += .42; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c;
        x.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6); x.restore();
      });
      if (++n < 140) requestAnimationFrame(frame); else x.clearRect(0, 0, c.width, c.height);
    })();
  };

  initReveal();
  refreshStats();
})();
