const PollResults = ({ results }) => {
    if (!results || !results.options) {
      return <p className="text-gray-600">No results available</p>
    }
  
    // Calculate total votes and percentages
    const totalVotes = results.options.reduce((sum, option) => sum + option.votes, 0)
  
    // Sort options by votes in descending order
    const sortedOptions = [...results.options]
      .sort((a, b) => b.votes - a.votes)
      .map((option) => ({
        ...option,
        percentage: totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0,
      }))
  
    return (
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">
          Poll Results ({totalVotes} {totalVotes === 1 ? "response" : "responses"})
        </h2>
  
        <div className="space-y-4">
          {sortedOptions.map((option, index) => (
            <div key={index} className="bg-white rounded-lg shadow p-4">
              <div className="mb-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium">
                    {option.text}
                    {option.isCorrect && (
                      <span className="ml-2 text-sm text-green-600 bg-green-100 px-2 py-1 rounded-full">
                        Correct Answer
                      </span>
                    )}
                  </span>
                  <span className="text-gray-600 font-semibold">{option.percentage}%</span>
                </div>
              </div>
  
              <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`absolute left-0 top-0 h-full transition-all duration-500 ease-out ${
                    option.isCorrect ? "bg-green-500" : "bg-blue-500"
                  }`}
                  style={{
                    width: `${option.percentage}%`,
                    opacity: option.percentage > 0 ? 1 : 0.5,
                  }}
                />
              </div>
  
              <div className="mt-1 flex justify-between text-sm text-gray-500">
                <span>
                  {option.votes} {option.votes === 1 ? "vote" : "votes"}
                </span>
                <span>{option.percentage}% of total</span>
              </div>
            </div>
          ))}
        </div>
  
        {totalVotes === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-lg">No votes yet</p>
          </div>
        )}
      </div>
    )
  }
  
  export default PollResults
  