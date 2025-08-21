import { useState, useEffect } from 'react';

export const useTheme = () => {
  const [theme, setTheme] = useState('light');
  const [artistMode, setArtistMode] = useState(false);

  // Theme management
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Artist mode management
  useEffect(() => {
    if (artistMode) {
      document.documentElement.setAttribute('data-artist', 'true');
    } else {
      document.documentElement.removeAttribute('data-artist');
    }
  }, [artistMode]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const toggleArtistMode = () => {
    setArtistMode((prev) => !prev);
  };

  return {
    theme,
    artistMode,
    toggleTheme,
    toggleArtistMode,
  };
};
