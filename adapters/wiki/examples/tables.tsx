export default function Tables() {
  return (
    <div class="wiki-row" style={{ gap: 28, alignItems: 'flex-start' }}>
      <table style={{ width: 300 }}>
        <thead>
          <tr>
            <th>Part</th>
            <th>Holds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tabs</td>
            <td>value</td>
          </tr>
          <tr>
            <td colspan="2">A cell can span columns</td>
          </tr>
          <tr>
            <td>Dialog</td>
            <td>open</td>
          </tr>
        </tbody>
      </table>
      <div class="wiki-col">
        <ul>
          <li>Bullets by depth</li>
          <li>
            Nested
            <ul>
              <li>Circle</li>
            </ul>
          </li>
        </ul>
        <ol start="3">
          <li>Numbers from a start</li>
          <li>and counting</li>
        </ol>
      </div>
    </div>
  );
}
