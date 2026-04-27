import LoginForm from '../components/common/LoginForm';

// Bubble configuration — each entry seeds the CSS custom properties that
// drive a single rising bubble (column position, diameter, animation
// duration / start delay, and how far it drifts sideways as it rises).
const BUBBLES = [
  { id: 1,  x: '8%',  size: '32px', duration: '14s', delay: '0s',   drift: '40px'  },
  { id: 2,  x: '15%', size: '20px', duration: '11s', delay: '1.5s', drift: '-28px' },
  { id: 3,  x: '22%', size: '48px', duration: '18s', delay: '0.5s', drift: '60px'  },
  { id: 4,  x: '35%', size: '26px', duration: '13s', delay: '3s',   drift: '-22px' },
  { id: 5,  x: '48%', size: '16px', duration: '17s', delay: '0s',   drift: '34px'  },
  { id: 6,  x: '55%', size: '40px', duration: '15s', delay: '2s',   drift: '-50px' },
  { id: 7,  x: '62%', size: '22px', duration: '12s', delay: '4s',   drift: '28px'  },
  { id: 8,  x: '72%', size: '30px', duration: '14s', delay: '1s',   drift: '-34px' },
  { id: 9,  x: '80%', size: '38px', duration: '16s', delay: '2.5s', drift: '46px'  },
  { id: 10, x: '88%', size: '20px', duration: '13s', delay: '0.8s', drift: '-24px' },
  { id: 11, x: '93%', size: '44px', duration: '19s', delay: '3.5s', drift: '54px'  },
  { id: 12, x: '4%',  size: '28px', duration: '15s', delay: '5s',   drift: '-40px' },
];

const LoginPage = () => {
  return (
    <div className="login-page">
      <div className="auth-brand" aria-label="SalesWolf">
        <img src="/saleswolf-icon-v2.png" alt="" className="auth-brand__icon" />
        <div className="auth-brand__text">
          <h1>
            Sales<span className="auth-brand__wolf">Wolf</span>
          </h1>
        </div>
      </div>
      <div className="bubbles" aria-hidden="true">
        {BUBBLES.map((b) => (
          <div
            key={b.id}
            className="bubble"
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
        className="login-mascot"
        src="/axolotl-full-length-removebg-preview.png"
        alt=""
        aria-hidden="true"
      />
      <div className="login-waves" aria-hidden="true">
        <svg
          className="login-waves__layer login-waves__layer--back"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
        >
          <path d="M0,40 C240,72 480,8 720,40 C960,72 1200,8 1440,40 L1440,80 L0,80 Z" />
        </svg>
        <svg
          className="login-waves__layer login-waves__layer--mid"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
        >
          <path d="M0,50 C240,18 480,82 720,50 C960,18 1200,82 1440,50 L1440,80 L0,80 Z" />
        </svg>
        <svg
          className="login-waves__layer login-waves__layer--front"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
        >
          <path d="M0,55 C240,80 480,30 720,55 C960,80 1200,30 1440,55 L1440,80 L0,80 Z" />
        </svg>
      </div>
      <LoginForm />
    </div>
  );
};

export default LoginPage;