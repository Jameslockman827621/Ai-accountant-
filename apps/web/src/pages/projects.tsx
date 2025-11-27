import React from 'react';

const projectCosts = [
  { project: 'Store Rollout', labor: '$8,400', materials: '$2,100', overhead: '$1,050', total: '$11,550' },
  { project: 'R&D Pilot', labor: '$6,200', materials: '$4,800', overhead: '$930', total: '$11,930' },
];

const ProjectsPage: React.FC = () => {
  return (
    <main className="p-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Project & Job Costing</h1>
        <p className="text-gray-600">Allocate labor, materials, and overhead per job.</p>
      </header>

      <section className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Costing Dashboard</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="py-2">Project</th>
              <th>Labor</th>
              <th>Materials</th>
              <th>Overhead</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {projectCosts.map(cost => (
              <tr key={cost.project} className="border-t">
                <td className="py-2">{cost.project}</td>
                <td>{cost.labor}</td>
                <td>{cost.materials}</td>
                <td>{cost.overhead}</td>
                <td className="font-semibold">{cost.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
};

export default ProjectsPage;
