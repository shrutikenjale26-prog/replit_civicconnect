## Packages
framer-motion | Page transitions and complex animations
date-fns | Date formatting for reports
recharts | Analytics charts for admin dashboard
clsx | Class name utility
tailwind-merge | Class name utility

## Notes
- Images should be uploaded to /api/upload (POST FormData with 'file') which returns { url: string }
- Audio files use the same upload endpoint
- Report status flow: Pending -> In Progress -> Resolved
- Admin role is simulated for demo purposes (accessible to logged-in users)
