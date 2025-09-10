import React from 'react';

const ThemeToggle = React.memo(({ theme, toggleTheme, artistMode, toggleArtistMode }) => {
  return (
    <div className="toggle-buttons">
      <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
      <button className="artist-toggle" onClick={toggleArtistMode} aria-label="Toggle artist mode">
        {artistMode ? '🐕' : '🎨'}
      </button>
    </div>
  );
});

export default ThemeToggle;
