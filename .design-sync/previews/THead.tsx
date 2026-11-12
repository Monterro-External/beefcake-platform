import { Card, TD, TH, THead, TR, Table } from 'beefcake-ui';

export const ClassFill = () => (
  <Card title="Classes this week">
    <Table>
      <THead>
        <TR>
          <TH>Class</TH>
          <TH>Starts</TH>
          <TH align="right">Booked</TH>
          <TH align="right">Capacity</TH>
        </TR>
      </THead>
      <tbody>
        <TR>
          <TD>Spinning 45</TD>
          <TD>Mon 06:30</TD>
          <TD align="right">22</TD>
          <TD align="right">24</TD>
        </TR>
        <TR>
          <TD>Yoga flow</TD>
          <TD>Mon 18:00</TD>
          <TD align="right">9</TD>
          <TD align="right">20</TD>
        </TR>
      </tbody>
    </Table>
  </Card>
);
