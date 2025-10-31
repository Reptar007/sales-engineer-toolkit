import React from 'react';
import { Link } from 'react-router-dom';
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
      <header className="top-header">
        <Link to="/" className="header-logo">
          <img src="/saleswolf-icon.png" alt="SalesWolf" className="header-logo-icon" />
          <h1>SalesWolf</h1>
        </Link>
      </header>
    </>
  );
});

export default Header;
