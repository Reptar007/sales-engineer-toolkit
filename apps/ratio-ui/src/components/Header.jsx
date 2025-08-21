import React from 'react';
import ThemeToggle from './ThemeToggle';

const Header = React.memo(({ theme, toggleTheme, artistMode, toggleArtistMode }) => {
  return (
    <>
      <ThemeToggle
        theme={theme}
        toggleTheme={toggleTheme}
        artistMode={artistMode}
        toggleArtistMode={toggleArtistMode}
      />
      <header>
        <h1>Ratio Estimator</h1>
      </header>
    </>
  );
});

export default Header;
