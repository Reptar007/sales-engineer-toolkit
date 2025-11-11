import React from 'react';
import { Link } from 'react-router-dom';

const Header = React.memo(({ toggleSidebar }) => {
  return (
    <header className="top-header">
      <button className="hamburger-button" onClick={toggleSidebar}>☰</button>
      <Link to="/" className="header-logo">
        <img src="/saleswolf-icon.png" alt="SalesWolf" className="header-logo-icon" />
        <h1>SalesWolf</h1>
      </Link>
    </header>
  );
});

export default Header;
