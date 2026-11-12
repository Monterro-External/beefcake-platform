import { Badge, Card, TD, TH, THead, TR, Table } from 'beefcake-ui';

export const FailedCharges = () => (
  <Card title="Open charges (3)">
    <Table>
      <THead>
        <TR>
          <TH align="right">Amount</TH>
          <TH>Why it failed</TH>
          <TH align="right">Attempt</TH>
          <TH>Status</TH>
        </TR>
      </THead>
      <tbody>
        <TR>
          <TD align="right" mono>
            449,00 kr
          </TD>
          <TD>Insufficient funds</TD>
          <TD align="right">2</TD>
          <TD>
            <Badge tone="warn">Retrying</Badge>
          </TD>
        </TR>
        <TR>
          <TD align="right" mono>
            449,00 kr
          </TD>
          <TD>Mandate revoked</TD>
          <TD align="right">4</TD>
          <TD>
            <Badge tone="bad">Abandoned</Badge>
          </TD>
        </TR>
        <TR>
          <TD align="right" mono>
            299,00 kr
          </TD>
          <TD>Card expired</TD>
          <TD align="right">1</TD>
          <TD>
            <Badge tone="warn">Retrying</Badge>
          </TD>
        </TR>
      </tbody>
    </Table>
  </Card>
);

export const Receipts = () => (
  <Card title="Paid (3)">
    <Table>
      <THead>
        <TR>
          <TH>Number</TH>
          <TH>Issued</TH>
          <TH>What for</TH>
          <TH align="right">VAT</TH>
          <TH align="right">Total</TH>
        </TR>
      </THead>
      <tbody>
        <TR>
          <TD mono>R-2026-01184</TD>
          <TD>1 Nov 2026</TD>
          <TD>Membership, November</TD>
          <TD align="right" mono>
            25,42 kr
          </TD>
          <TD align="right" mono>
            449,00 kr
          </TD>
        </TR>
        <TR>
          <TD mono>R-2026-00977</TD>
          <TD>1 Oct 2026</TD>
          <TD>Membership, October</TD>
          <TD align="right" mono>
            25,42 kr
          </TD>
          <TD align="right" mono>
            449,00 kr
          </TD>
        </TR>
        <TR>
          <TD mono>R-2026-00812</TD>
          <TD>14 Sep 2026</TD>
          <TD>Personal training, 5 sessions</TD>
          <TD align="right" mono>
            90,00 kr
          </TD>
          <TD align="right" mono>
            1 590,00 kr
          </TD>
        </TR>
      </tbody>
    </Table>
  </Card>
);
