import React from 'react';

const SearchBar = React.memo(({ searchTerm, onSearch }) => {
  return (
    <div className="search-container">
      <input
        type="text"
        placeholder="Search tests..."
        className="search-input"
        aria-label="Search tests"
        value={searchTerm}
        onChange={onSearch}
      />
    </div>
  );
});

export default SearchBar;
