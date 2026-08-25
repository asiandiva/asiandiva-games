/* Eggs Ever After -- apartment test bench.
   Still no game logic: no needs, no timers, no saving.
   What this DOES have is idle behaviour, because a pet that
   never moves on its own reads as a picture, not a pet. */

const room = document.getElementById('room');
const duck = document.getElementById('duck');
const slot = document.getElementById('slot');

const MOODS = ['neutral', 'happy', 'sad', 'sleeping'];

/* How far left and right the duck may wander, as a % of the room.
   Kept clear of the counter, the bed and the foreground plant. */
const MIN_X = 30;
const MAX_X = 70;

let mood     = 'neutral';
let walking  = false;
let timer    = null;

/* ---- mood ------------------------------------------------------------ */

function setMood(next) {
  mood = next;
  MOODS.forEach(m => duck.classList.remove('mood-' + m));
  duck.classList.remove('walking');
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

  restartIdle();
}

/* ---- wandering -------------------------------------------------------
   Pick a spot, waddle there, stand still a while, repeat.
   Distance sets the duration so the walk speed stays constant --
   without that, short hops look frantic and long ones look like
   the duck is gliding. */

function currentX() {
  return parseFloat(slot.style.left) || 50;
}

function walkTo(targetX) {
  const distance = Math.abs(targetX - currentX());
  const seconds  = Math.max(0.9, distance * 0.075);

  walking = true;
  slot.style.transitionDuration = seconds + 's';
  slot.style.left = targetX + '%';

  duck.classList.remove('mood-' + mood);
  duck.classList.add('walking');

  setTimeout(() => {
    walking = false;
    duck.classList.remove('walking');
    duck.classList.add('mood-' + mood);
    restartIdle();
  }, seconds * 1000);
}

function wander() {
  /* Always move a meaningful distance -- tiny shuffles look like a bug. */
  let target;
  do {
    target = MIN_X + Math.random() * (MAX_X - MIN_X);
  } while (Math.abs(target - currentX()) < 12);
  walkTo(target);
}

function restartIdle() {
  clearTimeout(timer);
  if (mood === 'sleeping') return;          // sleeping ducks stay put

  const pause = mood === 'happy'
    ? 1800 + Math.random() * 2500           // excitable
    : mood === 'sad'
      ? 7000 + Math.random() * 8000         // sulky, barely moves
      : 3000 + Math.random() * 5000;        // neutral

  timer = setTimeout(wander, pause);
}

/* ---- click pop -------------------------------------------------------
   Restarting a CSS animation needs a reflow between removing and
   re-adding the class, or the browser skips it entirely. */

duck.addEventListener('click', () => {
  if (walking) return;
  duck.classList.remove('mood-' + mood);
  duck.classList.add('popping');
  void duck.offsetWidth;
  setTimeout(() => {
    duck.classList.remove('popping');
    duck.classList.add('mood-' + mood);
  }, 600);
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

slot.style.left = '50%';
room.dataset.time = 'day';
setMood('neutral');
