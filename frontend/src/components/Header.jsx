import React from 'react';
import { Link } from 'react-router-dom';

const Header = React.memo(() => {
  return (
    <header className="top-header">
      <Link to="/" className="header-logo">
        <img src="/saleswolf-icon-v2.png" alt="SalesWolf" className="header-logo-icon" />
        <div className='header-text'>
          <h1>Sales<div className='header-wolf'>Wolf</div></h1>
          <p>HUNT • CLOSE • DOMINATE</p>
        </div>
      </Link>
    </header>
  );
});

export default Header;
