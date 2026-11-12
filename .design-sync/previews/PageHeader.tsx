import { Button, LinkButton, PageHeader } from 'beefcake-ui';

export const WithActions = () => (
  <PageHeader
    title="Members"
    subtitle="Södermalm · 1 284 active"
    actions={
      <>
        <Button>Export CSV</Button>
        <LinkButton href="/app/members/new" variant="primary">
          Add member
        </LinkButton>
      </>
    }
  />
);

export const TitleAndSubtitle = () => (
  <PageHeader title="Receipts" subtitle="Beefcake Gym Södermalm · amounts in SEK" />
);

export const TitleOnly = () => <PageHeader title="Access" />;
