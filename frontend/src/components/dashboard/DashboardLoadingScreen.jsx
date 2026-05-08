import React from 'react';
import './DashboardLoadingScreen.less';

// Same bubble seed shape as the login screen — column position, size,
// duration, delay, and lateral drift drive the rising bubble field.
const BUBBLES = [
  { id: 1, x: '6%', size: '34px', duration: '14s', delay: '0s', drift: '40px' },
  { id: 2, x: '14%', size: '20px', duration: '11s', delay: '1.5s', drift: '-28px' },
  { id: 3, x: '22%', size: '50px', duration: '18s', delay: '0.4s', drift: '60px' },
  { id: 4, x: '32%', size: '26px', duration: '13s', delay: '3s', drift: '-22px' },
  { id: 5, x: '42%', size: '18px', duration: '17s', delay: '0.2s', drift: '34px' },
  { id: 6, x: '52%', size: '42px', duration: '15s', delay: '2s', drift: '-50px' },
  { id: 7, x: '60%', size: '24px', duration: '12s', delay: '4s', drift: '28px' },
  { id: 8, x: '70%', size: '32px', duration: '14s', delay: '1s', drift: '-34px' },
  { id: 9, x: '78%', size: '40px', duration: '16s', delay: '2.5s', drift: '46px' },
  { id: 10, x: '86%', size: '22px', duration: '13s', delay: '0.8s', drift: '-24px' },
  { id: 11, x: '92%', size: '46px', duration: '19s', delay: '3.5s', drift: '54px' },
  { id: 12, x: '4%', size: '28px', duration: '15s', delay: '5s', drift: '-40px' },
];

/**
 * DashboardLoadingScreen
 *
 * Full-viewport "diving in" splash shown between login and the dashboard
 * while {@link useDashboardBootstrap} primes every dashboard data source.
 * Reuses the underwater visual language of the login screen (axolotl
 * mascot, rising bubbles, parallax bottom waves) so the transition feels
 * like one continuous scene.
 *
 * @param {object} props
 * @param {boolean} [props.hiding] Adds a fade-out class so the parent
 *   can play an exit animation before unmounting.
 * @param {string}  [props.message] Status line under the heading. Defaults
 *   to a friendly hunting-themed prompt.
 */
function DashboardLoadingScreen({ hiding = false, message = 'Tracking down your hunts…' }) {
  return (
    <div
      className={`dashboard-loading${hiding ? ' dashboard-loading--hiding' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!hiding}
    >
      <div className="dashboard-loading__bubbles" aria-hidden="true">
        {BUBBLES.map((b) => (
          <div
            key={b.id}
            className="dashboard-loading__bubble"
            style={{
              '--x': b.x,
              '--size': b.size,
              '--duration': b.duration,
              '--delay': b.delay,
              '--drift': b.drift,
            }}
          />
        ))}
      </div>

      <img
        className="dashboard-loading__mascot"
        src="/axolotl-full-length-removebg-preview.png"
        alt=""
        aria-hidden="true"
      />

      <div className="dashboard-loading__copy">
        <h2 className="dashboard-loading__title">
          Diving into Sales<span className="dashboard-loading__title-wolf">Wolf</span>
        </h2>
        <p className="dashboard-loading__message">{message}</p>
        <div className="dashboard-loading__progress" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default DashboardLoadingScreen;
