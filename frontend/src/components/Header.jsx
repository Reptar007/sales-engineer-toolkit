import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import ThemeToggle from './ThemeToggle';

const Header = React.memo(({ theme, toggleTheme, artistMode, toggleArtistMode }) => {
  const { user, logout } = useAuth();

  return (
    <>
      <ThemeToggle
        theme={theme}
        toggleTheme={toggleTheme}
        artistMode={artistMode}
        toggleArtistMode={toggleArtistMode}
      />
      <header>
        <h1>SalesWolf</h1>
        {user && (
          <div className="user-menu">
            <span className="user-name">Welcome, {user.name}!</span>
            <button onClick={logout} className="logout-button">
              Logout
            </button>
          </div>
        )}
      </header>
    </>
  );
});

export default Header;
