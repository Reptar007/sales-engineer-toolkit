import React from 'react';
import PropTypes from 'prop-types';

const FileUpload = React.memo(
  ({ selectedFile, errorMessage, isLoading, onFileChange, onSubmit }) => {
    return (
      <section className="section">
        <h2 className="section-title">Upload a .csv file</h2>
        <form
          onSubmit={onSubmit}
          className="upload-form"
          noValidate
          aria-describedby="upload-hint upload-error"
        >
          {/* Hidden file input for accessibility */}
          <input
            id="file-upload"
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            onClick={(e) => {
              e.currentTarget.value = '';
            }}
            className="visually-hidden"
          />

          <div className="file-controls">
            <label htmlFor="file-upload" className="btn file-btn">
              Choose CSV
            </label>

            <span className="file-name" aria-live="polite">
              {selectedFile ? selectedFile.name : 'No file chosen'}
            </span>

            <button type="submit" className="btn primary" disabled={!selectedFile || isLoading}>
              {isLoading ? 'Processing...' : 'Submit'}
            </button>
          </div>

          <small id="upload-hint" className="hint">
            Only .csv files are allowed.
          </small>

          {errorMessage && (
            <div id="upload-error" role="alert" className="error">
              {errorMessage}
            </div>
          )}
        </form>
      </section>
    );
  },
);

FileUpload.propTypes = {
  selectedFile: PropTypes.object,
  errorMessage: PropTypes.string.isRequired,
  isLoading: PropTypes.bool.isRequired,
  onFileChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
};

export default FileUpload;
