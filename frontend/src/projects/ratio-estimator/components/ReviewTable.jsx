import React from 'react';
import PropTypes from 'prop-types';

const ReviewTable = React.memo(({ data, shouldUseScrollableContainer, onApprove, onReject }) => {
  return (
    <div className={`table-wrapper ${shouldUseScrollableContainer ? 'scrollable' : ''}`}>
      <table className="review-table">
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Ratio</th>
            <th>Reasoning</th>
            <th>Approval</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => (
            <tr key={item.id} className={`row-${item.status}`}>
              <td>
                {item.testName}
                {item.status === 'rejected' && item.rejectionReason && (
                  <span
                    className={`rejection-indicator ${index < 2 ? 'tooltip-below' : ''}`}
                    aria-label={`Rejection reason: ${item.rejectionReason}`}
                    role="button"
                    tabIndex="0"
                  >
                    💬
                    <span className="tooltip">
                      <strong>Rejection Reason:</strong>
                      <br />
                      {item.rejectionReason}
                    </span>
                  </span>
                )}
              </td>
              <td>{item.ratio}</td>
              <td>{item.reasoning}</td>
              <td className="actions">
                <button
                  type="button"
                  className={`btn circular reject ${item.status === 'rejected' ? 'active' : ''}`}
                  onClick={() => onReject({ name: item.testName, id: item.id })}
                  aria-label={`Reject ${item.testName}`}
                  title={item.status === 'rejected' ? 'Already rejected' : 'Reject'}
                  disabled={item.status === 'approved'}
                >
                  ✕
                </button>
                <button
                  type="button"
                  className={`btn circular approve ${item.status === 'approved' ? 'active' : ''}`}
                  onClick={() => onApprove(item)}
                  aria-label={`Approve ${item.testName}`}
                  title={item.status === 'approved' ? 'Already approved' : 'Approve'}
                  disabled={item.status === 'rejected'}
                >
                  ✓
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

ReviewTable.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      testName: PropTypes.string.isRequired,
      ratio: PropTypes.string.isRequired,
      reasoning: PropTypes.string.isRequired,
      status: PropTypes.oneOf(['pending', 'approved', 'rejected']).isRequired,
      rejectionReason: PropTypes.string,
    }),
  ).isRequired,
  shouldUseScrollableContainer: PropTypes.bool.isRequired,
  onApprove: PropTypes.func.isRequired,
  onReject: PropTypes.func.isRequired,
};

export default ReviewTable;
