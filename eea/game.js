/* Apartment test bench.
   No game logic on purpose -- no timers, no needs, no saving.
   This exists only to check the room and the duck feel alive. */

const room = document.getElementById('room');
const duck = document.getElementById('duck');
const slot = document.getElementById('slot');

const MOODS = ['neutral', 'happy', 'sad', 'sleeping'];

/* ---- mood ------------------------------------------------------------ */

function setMood(mood) {
  MOODS.forEach(m => duck.classList.remove('mood-' + m));
  duck.classList.add('mood-' + mood);
  duck.src = `sprites/duck-toddler-${mood}.png`;

  slot.querySelectorAll('.zzz').forEach(z => z.remove());
  if (mood === 'sleeping') {
    ['z', 'z2'].forEach(c => {
      const z = document.createElement('span');
      z.className = 'zzz ' + c;
      z.textContent = 'z';
      slot.appendChild(z);
    });
  }
}

/* ---- click pop -------------------------------------------------------
   Restarting a CSS animation needs a reflow between removing and
   re-adding the class, or the browser skips it entirely. */

duck.addEventListener('click', () => {
  const held = Array.from(duck.classList).find(c => c.startsWith('mood-'));
  duck.classList.remove(held);
  duck.classList.add('popping');
  void duck.offsetWidth;
  setTimeout(() => {
    duck.classList.remove('popping');
    duck.classList.add(held);
  }, 550);
});

/* ---- panel ----------------------------------------------------------- */

function wire(attr, apply) {
  document.querySelectorAll(`[data-${attr}]`).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('button')
         .forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      apply(btn.dataset[attr]);
    });
  });
}

wire('mood', setMood);
wire('time', v => room.dataset.time = v);

/* ---- friendly failure if the PNGs aren't there ------------------------ */

duck.addEventListener('error', () => room.classList.add('no-art'));
duck.addEventListener('load',  () => room.classList.remove('no-art'));

/* ---- start ----------------------------------------------------------- */

room.dataset.time = 'day';
setMood('neutral');
