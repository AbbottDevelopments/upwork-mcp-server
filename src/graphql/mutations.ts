/**
 * GraphQL mutation definitions for Upwork API.
 */

/**
 * Create a new milestone on a fixed-price contract.
 */
export const CREATE_MILESTONE = `
  mutation CreateMilestone($input: CreateMilestoneInput!) {
    createMilestoneV2(input: $input) {
      milestone {
        id
        description
        status
        amount {
          rawValue
          currency
        }
        dueDate
      }
    }
  }
`;

/**
 * Edit an existing pending milestone.
 */
export const EDIT_MILESTONE = `
  mutation EditMilestone($input: EditMilestoneInput!) {
    editMilestone(input: $input) {
      milestone {
        id
        description
        status
        amount {
          rawValue
          currency
        }
        dueDate
      }
    }
  }
`;

/**
 * Request approval/payment for a completed milestone.
 */
export const REQUEST_MILESTONE_APPROVAL = `
  mutation RequestMilestoneApproval($input: RequestMilestoneApprovalInput!) {
    requestMilestoneApproval(input: $input) {
      milestone {
        id
        status
      }
    }
  }
`;
