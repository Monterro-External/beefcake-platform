import { Pagination } from 'beefcake-ui';

export const MiddlePage = () => (
  <div className="w-full">
    <Pagination basePath="/app/members" page={3} pageSize={50} total={1284} query={{ status: 'active' }} />
  </div>
);

export const FirstPage = () => (
  <div className="w-full">
    <Pagination basePath="/app/members" page={1} pageSize={50} total={1284} />
  </div>
);

export const LastPage = () => (
  <div className="w-full">
    <Pagination basePath="/app/members" page={26} pageSize={50} total={1284} />
  </div>
);
