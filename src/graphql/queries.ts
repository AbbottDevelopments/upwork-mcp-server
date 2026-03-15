/**
 * GraphQL query definitions for Upwork API.
 */

/**
 * Search job postings with server-side filters.
 * Uses MarketplaceJobFilter input type.
 */
export const SEARCH_JOBS = `
  query SearchJobs($filter: MarketplaceJobFilter, $sortAttributes: [MarketplaceJobPostingSortAttribute], $pagination: PaginationInput) {
    marketplaceJobPostings(
      marketplaceJobFilter: $filter
      sortAttributes: $sortAttributes
      pagination: $pagination
    ) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          ciphertext
          title
          description
          job {
            contractTerms {
              contractType
              amount {
                rawValue
                currency
                displayValue
              }
              hourlyBudgetType
              fixedBudgetMin {
                rawValue
                currency
              }
              fixedBudgetMax {
                rawValue
                currency
              }
            }
            contractorTier
          }
          content {
            skills {
              id
              prettyName
            }
            category {
              id
              name
            }
          }
          classification {
            category {
              id
              name
            }
            subCategory {
              id
              name
            }
          }
          client {
            totalHires
            totalPostedJobs
            totalSpent {
              rawValue
              currency
            }
            totalFeedback
            verificationStatus
            companyName
            location {
              city
              country
            }
            memberSince
            totalReviews
          }
          freelancersNeeded
          proposalsTotalCount
          invitesTotalCount
          publishedDateTime
          duration
          engagement
          experienceLevel
          weeklyBudget {
            rawValue
            currency
          }
          hourlyBudgetMin {
            rawValue
            currency
          }
          hourlyBudgetMax {
            rawValue
            currency
          }
          occupations {
            id
            prefLabel
          }
          location {
            city
            country
          }
          connectsRequired
        }
      }
    }
  }
`;

/**
 * Get full job posting details including client intelligence.
 */
export const GET_JOB_DETAILS = `
  query GetJobDetails($id: ID!) {
    marketplaceJobPosting(id: $id) {
      id
      ciphertext
      title
      description
      job {
        contractTerms {
          contractType
          amount {
            rawValue
            currency
            displayValue
          }
          hourlyBudgetType
          fixedBudgetMin {
            rawValue
            currency
          }
          fixedBudgetMax {
            rawValue
            currency
          }
        }
        contractorTier
      }
      content {
        skills {
          id
          prettyName
        }
        category {
          id
          name
        }
      }
      classification {
        category {
          id
          name
        }
        subCategory {
          id
          name
        }
      }
      client {
        totalHires
        activeContractCount
        totalPostedJobs
        totalSpent {
          rawValue
          currency
        }
        totalFeedback
        verificationStatus
        companyName
        location {
          city
          country
        }
        memberSince
        totalReviews
        avgHourlyRate {
          rawValue
          currency
        }
      }
      freelancersNeeded
      proposalsTotalCount
      invitesTotalCount
      publishedDateTime
      duration
      engagement
      experienceLevel
      weeklyBudget {
        rawValue
        currency
      }
      hourlyBudgetMin {
        rawValue
        currency
      }
      hourlyBudgetMax {
        rawValue
        currency
      }
      occupations {
        id
        prefLabel
      }
      location {
        city
        country
      }
      connectsRequired
      enterpriseJob
      tierText
      tier
      premium
      applied
      contractorTier
    }
  }
`;

/**
 * List vendor proposals with status filtering.
 */
export const LIST_PROPOSALS = `
  query ListProposals($filter: VendorProposalFilter, $pagination: PaginationInput) {
    vendorProposals(
      filter: $filter
      pagination: $pagination
    ) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          job {
            id
            title
            ciphertext
          }
          coverLetter
          chargeRate {
            rawValue
            currency
          }
          duration
          status
          createdDateTime
          client {
            companyName
            totalHires
            totalFeedback
            verificationStatus
          }
          interviewStatus
          currentMilestone {
            id
            description
            amount {
              rawValue
              currency
            }
          }
        }
      }
    }
  }
`;

/**
 * List vendor contracts with status filtering.
 */
export const LIST_CONTRACTS = `
  query ListContracts($filter: VendorContractFilter, $pagination: PaginationInput) {
    vendorContracts(
      filter: $filter
      pagination: $pagination
    ) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          title
          status
          contractType
          client {
            companyName
            totalHires
            totalFeedback
            verificationStatus
          }
          chargeRate {
            rawValue
            currency
          }
          budget {
            rawValue
            currency
          }
          startDateTime
          endDateTime
          totalEarnings {
            rawValue
            currency
          }
          weeklyHoursLimit
        }
      }
    }
  }
`;

/**
 * Get full contract details including milestones.
 */
export const GET_CONTRACT_DETAILS = `
  query GetContractDetails($id: ID!) {
    vendorContract(id: $id) {
      id
      title
      description
      status
      contractType
      client {
        companyName
        totalHires
        totalFeedback
        verificationStatus
        location {
          city
          country
        }
      }
      chargeRate {
        rawValue
        currency
      }
      budget {
        rawValue
        currency
      }
      startDateTime
      endDateTime
      totalEarnings {
        rawValue
        currency
      }
      totalHoursWorked
      weeklyHoursLimit
      milestones {
        id
        description
        status
        amount {
          rawValue
          currency
        }
        dueDate
        paidDate
      }
      feedback {
        score
        comment
      }
    }
  }
`;

/**
 * Get earnings/time report for a freelancer.
 */
/**
 * List message rooms with activity status.
 */
export const LIST_ROOMS = `
  query ListRooms($filter: RoomListFilter, $pagination: PaginationInput) {
    roomList(
      filter: $filter
      pagination: $pagination
    ) {
      totalCount
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          roomName
          roomType
          lastMessage {
            id
            text
            createdDateTime
            sender {
              id
              name
            }
          }
          unreadCount
          participants {
            id
            name
          }
          contract {
            id
            title
          }
          updatedDateTime
        }
      }
    }
  }
`;

export const GET_EARNINGS_REPORT = `
  query GetEarningsReport($filter: FreelancerTimeReportFilter) {
    freelancerTimeReport(filter: $filter) {
      totalCharges {
        rawValue
        currency
      }
      totalHours
      entries {
        date
        hours
        charges {
          rawValue
          currency
        }
        contract {
          id
          title
        }
      }
    }
  }
`;
